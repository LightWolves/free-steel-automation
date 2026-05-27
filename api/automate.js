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

  // Our master variable to store the link whenever it appears
  let snatchedDownloadLink = null;

  // --- 🕸️ THE GLOBAL NET: INSTALLED AT SECOND ONE ---
  // This stays active the entire time. If the site auto-downloads at ANY point, we catch it.
  await page.setRequestInterception(true);
  page.on('request', (interceptedRequest) => {
    const url = interceptedRequest.url();
    
    if (url.includes('worker') || url.includes('.mp4') || url.includes('.m4a') || url.includes('.mp3') || url.includes('download') || url.includes('stream')) {
      snatchedDownloadLink = url;
      interceptedRequest.abort(); // KILL THE FILE DOWNLOAD IMMEDIATELY!
    } else {
      interceptedRequest.continue();
    }
  });

  // Anti-popup ad trap
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const popupPage = await target.page();
      if (!popupPage) return;
      const url = popupPage.url();
      if (url.includes('worker') || url.includes('.mp4') || url.includes('.m4a') || url.includes('.mp3')) {
        snatchedDownloadLink = url;
      }
      await popupPage.close(); // Crush the ad tab
    }
  });

  try {
    // 1. Open the website
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 2. Type the YouTube link into the box
    await page.waitForSelector('#postUrl');
    await page.type('#postUrl', youtubeUrl);

    // 3. Click the initial convert button
    await page.waitForSelector('button.btn-download');
    await page.click('button.btn-download');

    // 4. Wait for the quality selection dropdown to appear
    await page.waitForSelector('.download-option', { timeout: 30000 });

    // 5. Select your preferred quality option
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

    // 6. Click the button to start server processing
    await page.waitForSelector('#downloadButton');
    await page.click('#downloadButton');

    // --- 🏎️ THE SMART WAITING LOOP ---
    // We poll the page for up to 60 seconds. 
    // If our global net already snatched an auto-download link, we break out instantly!
    let attempts = 0;
    while (!snatchedDownloadLink && attempts < 60) {
      
      // Check if that manual backup button has appeared on the screen yet
      const manualButtonExists = await page.evaluate(() => {
        return !!document.querySelector('.download-container.btn-download');
      });

      // If it showed up and we still don't have our link, smash it!
      if (manualButtonExists && !snatchedDownloadLink) {
        await page.click('.download-container.btn-download').catch(() => {});
      }

      // Rest for 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!snatchedDownloadLink) {
      throw new Error("Could not capture the download stream link before timeout.");
    }

    // 7. Success! Send the clean link back to your Google Sheet popup window
    return res.status(200).json({ success: true, downloadLink: snatchedDownloadLink });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    // Keep your session clean and free
    await browser.close();
    await client.sessions.release(session.id);
  }
}
