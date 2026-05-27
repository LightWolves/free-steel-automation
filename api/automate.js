import Steel from 'steel-sdk';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { targetUrl, youtubeUrl, quality } = req.body;
  const client = new Steel({ steelAPIKey: process.env.STEEL_API_KEY });
  const session = await client.sessions.create();

  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://connect.steel.dev?apiKey=${process.env.STEEL_API_KEY}&sessionId=${session.id}`
  });
  const page = await browser.newPage();

  let snatchedDownloadLink = null;

  // 1. RESPONSE LISTENER: This catches the link as it returns from the server
  page.on('response', async (response) => {
    const url = response.url();
    // Watch for the specific download pattern we saw in your logs
    if (url.includes('dl.iamworker.com') || url.includes('.mp4') || url.includes('.m4a')) {
      snatchedDownloadLink = url;
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await page.type('#postUrl', youtubeUrl);
    await page.click('button.btn-download');

    await page.waitForSelector('.download-option', { timeout: 30000 });
    
    // Select quality
    const optionValue = await page.evaluate((q) => {
      const el = document.querySelector('.download-option');
      const opt = Array.from(el.options).find(o => o.text.includes(q) || o.value.includes(q));
      return opt ? opt.value : el.options[0].value;
    }, quality || '360p');
    
    await page.select('.download-option', optionValue);
    await page.click('#downloadButton');
    
    // Wait for the final button to appear and click it
    await page.waitForSelector('.download-container.btn-download', { timeout: 60000 });
    await page.click('.download-container.btn-download');

    // Wait for the 'snatchedDownloadLink' to be populated by the response listener
    for(let i = 0; i < 20; i++) {
      if (snatchedDownloadLink) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!snatchedDownloadLink) throw new Error("Link never appeared in response logs.");

    // SUCCESS: Send the link back to Google Sheets
    return res.status(200).json({ success: true, downloadLink: snatchedDownloadLink });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    await browser.close();
    await client.sessions.release(session.id);
  }
}
