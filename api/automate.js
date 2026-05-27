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

  let snatchedDownloadLink = null;

  // --- ANTIVIRUS / ANTI-POPUP AD TRAP ---
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const popupPage = await target.page();
      if (!popupPage) return;

      const url = popupPage.url();
      
      // If a popup opens with a file distribution URL, grab it!
      if (url.includes('worker') || url.includes('.mp4') || url.includes('.m4a') || url.includes('.mp3') || url.includes('download') || url.includes('stream')) {
        snatchedDownloadLink = url;
      }
      
      // Smash the popup immediately so it doesn't waste resources or memory
      await popupPage.close();
    }
  });

  try {
    // 1. Open the website
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 2. Type the YouTube link into the box
    await page.waitForSelector('#postUrl');
    await page.type('#postUrl', youtubeUrl);

    // 3. Click the initial convert button (specifically targeting the <button> tag)
    await page.waitForSelector('button.btn-download');
    await page.click('button.btn-download');

    // 4. Wait for the quality selection dropdown to appear
    await page.waitForSelector('.download-option', { timeout: 30000 });

    // 5. Select your preferred quality option (e.g., "360p")
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

    // 6. Click the button to start the server-side video generation
    await page.waitForSelector('#downloadButton');
    await page.click('#downloadButton');

    // 7. THE FIX: Wait up to 60 seconds for the processing wheel to stop 
    // and for your new confirmation download div to appear!
    await page.waitForSelector('.download-container.btn-download', { timeout: 60000 });
    
    // Give the page 2 seconds of breathing room to wire up its click functions
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Click the final download button to force out the file link!
    await page.click('.download-container.btn-download');

    // 8. THE WAITING ROOM (Snares the link from either the popup or an updated href link)
    let attempts = 0;
    while (!snatchedDownloadLink && attempts < 30) {
      const currentHref = await page.evaluate(() => {
        const anchor = document.querySelector('#downloadButton');
        return anchor ? anchor.href : '';
      });

      if (currentHref && currentHref.startsWith('http') && !currentHref.includes('javascript')) {
        snatchedDownloadLink = currentHref;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!snatchedDownloadLink) {
      throw new Error("Timed out waiting for the website to hand over the final file link.");
    }

    // 9. Send the clean link back to your Google Sheet popup window
    return res.status(200).json({ success: true, downloadLink: snatchedDownloadLink });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    await browser.close();
    await client.sessions.release(session.id);
  }
}
