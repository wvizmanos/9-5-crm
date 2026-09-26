/* Browser click-smoke for the 9-5 CRM (NineToFive) multichannel controls.
 *   npm run build
 *   npx vite preview --port 4173 --strictPort
 *   node multichannel-smoke.cjs          # SMOKE_URL=... to override
 *
 * Demo mode only: must make zero backend calls.
 * The mailto handoff tears the document down in headless Chrome, so it runs
 * last except for the final section, which reloads the app on purpose.
 */
const puppeteer = require("puppeteer");

const URL = process.env.SMOKE_URL || "http://localhost:4173/9-5-crm/";
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? "PASS  " : "FAIL  ") + name + (detail ? "  -> " + detail : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const setValue = (page, sel, value) => page.$eval(sel, (el, v) => {
  const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value").set;
  set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

const text = (page) => page.evaluate(() => document.body.innerText);
const srcDoc = (page) => page.evaluate(() => {
  const f = document.querySelector('iframe[title="Quotation preview"]');
  return f ? f.getAttribute("srcdoc") || "" : "";
});

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errors = [];
  const backendHits = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("request", (r) => { if (r.url().includes("script.google.com")) backendHits.push(r.url()); });

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  // Stop anchors from actually navigating: the WhatsApp / Viber / SMS chips are
  // real links, and a stray wa.me tab hangs the harness. preventDefault in the
  // capture phase does not stop React's own onClick, so the handlers still run.
  await page.evaluate(() => {
    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (a) e.preventDefault();
    }, true);
  });
  await sleep(1300);

  check("app boots with content", (await text(page)).length > 200);
  check("brands as NineToFive", (await text(page)).includes("NineToFive"));

  const opened = await page.evaluate(() => {
    const card = document.querySelector("div.cursor-pointer");
    if (!card) return false;
    card.click();
    return true;
  });
  await sleep(900);
  check("lead drawer opens", opened && (await text(page)).includes("Activity log"));

  const wa = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).find((x) => (x.textContent || "").includes("Chat on WhatsApp"));
    return a ? a.getAttribute("href") : null;
  });
  check("WhatsApp chip unchanged", !!wa && wa.startsWith("https://wa.me/"), wa || "(missing)");

  const viber = await page.evaluate(() => { const a = document.querySelector('a[data-channel="viber"]'); return a ? a.getAttribute("href") : null; });
  check("Viber deep link", !!viber && viber.startsWith("viber://chat?number=%2B63"), viber || "(missing)");

  const sms = await page.evaluate(() => { const a = document.querySelector('a[data-channel="sms"]'); return a ? a.getAttribute("href") : null; });
  check("SMS deep link", !!sms && sms.startsWith("sms:+63"), sms || "(missing)");

  check("no reason line when the phone is fine", !(await text(page)).includes("Viber and SMS are unavailable"));

  // ---- WhatsApp touch logging ------------------------------------------
  await page.evaluate(() => { window.__wa = []; window.open = (u) => { window.__wa.push(u); return null; }; });
  const activityBefore = await text(page);
  const clickedChip = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /Warm follow-up/.test(x.textContent || ""));
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(700);
  const activityAfter = await text(page);
  const waOpened = await page.evaluate(() => window.__wa || []);
  check("template chip opens WhatsApp with the message",
    clickedChip && waOpened.length === 1 && waOpened[0].startsWith("https://wa.me/") && waOpened[0].includes("text="),
    JSON.stringify(waOpened).slice(0, 90));
  check("WhatsApp touch is logged to the activity log",
    !activityBefore.includes("WhatsApp opened: Warm follow-up") && activityAfter.includes("WhatsApp opened: Warm follow-up"));
  const templateButtons = await page.evaluate(() => Array.from(document.querySelectorAll("button"))
    .map((b) => (b.textContent || "").trim())
    .filter((t) => /First touch|Promo nudge|Price list|Price Quotation|Warm follow-up/.test(t)));
  check("template chips trimmed to the warm follow-up only",
    templateButtons.length === 1 && templateButtons[0] === "Warm follow-up", JSON.stringify(templateButtons));
  check("chat button also logs a touch",
    (await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll("a")).find((x) => (x.textContent || "").includes("Chat on WhatsApp"));
      if (!a) return false;
      a.click();
      return true;
    })) && (await page.evaluate(() => document.body.innerText.split("WhatsApp opened").length - 1)) >= 2,
    "");

  // ---- quotation email composer ----------------------------------------
  const toggled = await page.evaluate(() => {
    const b = document.getElementById("email-quotation-toggle");
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(700);
  check("Email quotation opens", toggled);

  const fields = await page.evaluate(() => ({
    to: !!document.getElementById("quotation-to"),
    title: !!document.getElementById("quotation-title"),
    link: !!document.getElementById("quotation-link"),
    send: !!document.getElementById("quotation-send"),
  }));
  check("composer fields render (incl. link field)", fields.to && fields.title && fields.link && fields.send, JSON.stringify(fields));

  const sd = await srcDoc(page);
  check("preview renders branded NineToFive html", sd.length > 400 && sd.includes("NineToFive"), "srcdoc chars=" + sd.length);
  check("preview never says WA AIDA", !/WA AIDA|AIDA/.test(sd));
  check("link hint reflects no tracked link (demo)", (await text(page)).includes("No tracked link for this lead yet"));

  await page.click("#quotation-send");
  await sleep(500);
  check("empty recipient is rejected", (await text(page)).includes("Enter a valid recipient email"));

  await setValue(page, "#quotation-to", "owner@shop.ph");
  await setValue(page, "#quotation-title", "");
  await sleep(300);
  await page.click("#quotation-send");
  await sleep(500);
  check("missing title is rejected", (await text(page)).includes("Give the quotation a title first"));
  check("composer stayed open after both rejections", await page.evaluate(() => !!document.getElementById("quotation-title")));

  await setValue(page, "#quotation-title", "Inventory system setup");
  await setValue(page, 'input[placeholder="Amount (PHP)"]', "85000");
  await setValue(page, 'textarea[placeholder="What is included - one item per line"]', "Barcode inventory setup\nStaff training");
  await sleep(700);
  const sd2 = await srcDoc(page);
  check("preview follows the composer",
    sd2.includes("Inventory system setup") && sd2.includes("85,000") && sd2.includes("Barcode inventory setup"),
    "chars=" + sd2.length);
  check("amount renders as pesos", sd2.includes("\u20b1"), "");

  check("zero backend calls in demo mode", backendHits.length === 0, backendHits.length + " hit(s)");
  check("zero runtime errors before the handoff", errors.length === 0, errors.slice(0, 4).join(" || ") || "NONE");

  // ---- demo-mode handoff (tears the document down) ----------------------
  const urlBefore = page.url();
  await page.click("#quotation-send");
  await sleep(1200);
  const composerGone = await page.evaluate(() => !document.getElementById("quotation-title")).catch(() => true);
  check("demo send hands off to the mail app (composer closes)", composerGone, "url before=" + urlBefore);

  // ---- a lead whose phone has no usable digits --------------------------
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1200);
  const seeded = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => {
      try { const v = JSON.parse(localStorage.getItem(k)); return v && Array.isArray(v.leads) && v.leads.length; } catch { return false; }
    });
    if (!key) return null;
    const snap = JSON.parse(localStorage.getItem(key));
    snap.leads[0] = { ...snap.leads[0], phone: "Lala", activity: [] };
    localStorage.setItem(key, JSON.stringify(snap));
    return { key: key.replace(/[a-z]/gi, "\u2022"), n: snap.leads.length };
  });
  check("seeded a cache snapshot with a bad phone", !!seeded, JSON.stringify(seeded));

  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1400);
  await page.evaluate(() => { const c = document.querySelector("div.cursor-pointer"); if (c) c.click(); });
  await sleep(900);
  const state = await page.evaluate(() => ({
    viberDisabled: !document.querySelector('a[data-channel="viber"]'),
    smsDisabled: !document.querySelector('a[data-channel="sms"]'),
    reason: document.body.innerText.includes("has no usable digits, so Viber and SMS are unavailable"),
    showsNumber: document.body.innerText.includes("Lala"),
  }));
  check("chips disable when the phone has no digits", state.viberDisabled && state.smsDisabled, JSON.stringify(state));
  check("disabled chips now say WHY (visible, not a tooltip)", state.reason && state.showsNumber, "");

  // no number -> a WhatsApp touch must NOT be recorded
  await page.evaluate(() => { window.__wa2 = []; window.open = (u) => { window.__wa2.push(u); return null; }; });
  const countBefore = await page.evaluate(() => (document.body.innerText.match(/WhatsApp opened: Warm follow-up/g) || []).length);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /Warm follow-up/.test(x.textContent || ""));
    if (b) b.click();
  });
  await sleep(600);
  const countAfter = await page.evaluate(() => (document.body.innerText.match(/WhatsApp opened: Warm follow-up/g) || []).length);
  check("no WhatsApp touch logged when there is no usable number", countAfter === countBefore,
    "log entries before=" + countBefore + " after=" + countAfter);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
  if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join(", ")); process.exit(1) }
})().catch((e) => { console.log("FATAL:", e.message); process.exit(1) });
