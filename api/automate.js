import Steel from 'steel-sdk';
import puppeteer from 'puppeteer-core';

export default async function handler(req, res) {
  // Only allow Google Sheets to talk to this file
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const STEEL_API_KEY = process.env.STEEL_API_KEY;
  const { targetUrl } = req.body;

  // Start the Steel cloud browser session
  const client = new Steel({ steelAPIKey: STEEL_API_KEY });
  const session = await client.sessions.create();

  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}&sessionId=${session.id}`
  });
  const page = await browser.newPage();

  // Instantly close any annoying popups that open up
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const popupPage = await target.page();
      if (popupPage) await popupPage.close();
    }
  });

  try {
    // 1. Go to the website
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // 2. [PLACEHOLDER] We will put your custom clicks/typing lines here later!
    // For now, it will just load the page successfully.

    return res.status(200).json({ success: true, data: "Successfully connected to website!" });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    // CRITICAL: Closes the browser so you don't use up your free credits
    await browser.close();
    await client.sessions.release(session.id);
  }
}
