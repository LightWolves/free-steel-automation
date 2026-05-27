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

  // 1. SURGICAL POPUP KILLER (Don't kill the main site, just kill the extra windows)
  browser.on('targetcreated', async (target) => {
    const newPage = await target.page();
    if (newPage) {
      const url = newPage.url();
      if (url.includes('google.com') || url.includes('ads')) {
        await newPage.close();
      }
    }
  });

  // 2. SURGICAL DOWNLOAD INTERCEPTOR
  await page.setRequestInterception(true);
  let snatchedDownloadLink = null;
  page.on('request', (req) => {
    const url = req.url();
    // Only target the specific download domains we care about
    if (url.includes('dl.iamworker.com') || url.includes('.mp4') || url.includes('.m4a')) {
      snatchedDownloadLink = url;
      req.abort(); 
    } else {
      req.continue();
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await page.type('#postUrl', youtubeUrl);
    await page.click('button.btn-download');

    await page.waitForSelector('.download-option', { timeout: 30000 });
    
    // Select Quality
    const optionValue = await page.evaluate((q) => {
      const el = document.querySelector('.download-option');
      const opt = Array.from(el.options).find(o => o.text.includes(q) || o.value.includes(q));
      return opt ? opt.value : el.options[0].value;
    }, quality || '360p');
    
    await page.select('.download-option', optionValue);
    await page.click('#downloadButton');
    
    // 3. WAIT FOR THE DOWNLOAD TRIGGER
    await page.waitForSelector('.download-container.btn-download', { timeout: 60000 });
    await page.click('.download-container.btn-download');

    // 4. WAIT FOR THE SNATCH
    for(let i = 0; i < 20; i++) {
      if (snatchedDownloadLink) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!snatchedDownloadLink) throw new Error("Link not caught by interceptor.");
    return res.status(200).json({ success: true, downloadLink: snatchedDownloadLink });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    await browser.close();
    await client.sessions.release(session.id);
  }
}
