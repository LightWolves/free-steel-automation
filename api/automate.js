import Steel from 'steel-sdk';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STEEL_API_KEY = process.env.STEEL_API_KEY;
  const { targetUrl, youtubeUrl, quality } = req.body;

  const client = new Steel({ steelAPIKey: STEEL_API_KEY });
  const session = await client.sessions.create();

  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}&sessionId=${session.id}`
  });
  const page = await browser.newPage();

  // Create a placeholder variable to hold our prize link
  let snatchedDownloadLink = null;

  // --- ANTIVIRUS / ANTI-POPUP AD TRAP ---
  // This watches every single new tab or popup that tries to open
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const popupPage = await target.page();
      if (!popupPage) return;

      const url = popupPage.url();
      
      // If the popup URL contains file keywords, it's not an ad—it's our download link!
      if (url.includes('worker') || url.includes('.mp4') || url.includes('.m4a') || url.includes('.mp3') || url.includes('download')) {
        snatchedDownloadLink = url;
      }
      
      // CLOSE IT IMMEDIATELY. This kills ads AND stops the cloud from downloading files.
      await popupPage.close();
    }
  });

  try {
    // 1. Open the website
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 2. Type the YouTube link into the box
    await page.waitForSelector('#postUrl');
    await page.type('#postUrl', youtubeUrl);

    // 3. Click the initial convert button
    await page.waitForSelector('.btn-download');
    await page.click('.btn-download');

    // 4. Wait for the quality selection dropdown to appear
    await page.waitForSelector('.download-option', { timeout: 30000 });

    // 5. Code logic to find and select your preferred quality option (e.g., "360p")
    const optionValue = await page.evaluate((requestedQuality) => {
      const selectElement = document.querySelector('.download-option');
      if (!selectElement) return null;
      const options = Array.from(selectElement.options);
      const matchedOption = options.find(opt => 
        opt.text.includes(requestedQuality) || opt.value.includes(requestedQuality)
      );
      return matchedOption ? matchedOption.value : null;
    }, quality || '360p');

    if (optionValue) {
      await page.select('.download-option', optionValue);
    }

    // 6. CLICK THE FINAL DOWNLOAD BUTTON
    await page.waitForSelector('#downloadButton');
    await page.click('#downloadButton');

    // 7. THE WAITING ROOM (Snares the link during processing)
    // We poll the page and browser for up to 40 seconds waiting for the link to pop up
    let attempts = 0;
    while (!snatchedDownloadLink && attempts < 40) {
      // Check if the button's own link changed from "javascript:void(0)" to a real download URL
      const currentHref = await page.evaluate(() => {
        const btn = document.querySelector('#downloadButton');
        return btn ? btn.href : '';
      });

      if (currentHref && currentHref.startsWith('http')) {
        snatchedDownloadLink = currentHref;
        break;
      }

      // Pause for 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!snatchedDownloadLink) {
      throw new Error("Timed out waiting for the website to finish processing the video link.");
    }

    // 8. VICTORY! Send the raw download link back to Google Sheets
    return res.status(200).json({ success: true, downloadLink: snatchedDownloadLink });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    // Make sure everything closes securely so you never pay money
    await browser.close();
    await client.sessions.release(session.id);
  }
}
