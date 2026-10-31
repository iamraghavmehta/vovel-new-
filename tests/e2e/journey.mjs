// End-to-end journey in headless Chromium. Dictionary HTTP calls are intercepted with
// fixtures because CI/sandbox may have no access to dictionaryapi.dev. App code is unchanged.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const dist = path.resolve("dist");
const shots = process.env.SHOTS_DIR ?? "/tmp/claude-0/-home-claude/efacbb0a-933a-5485-9c7d-19b9ae7c61be/scratchpad";
fs.mkdirSync(shots, { recursive: true });
const server = http.createServer((req, res) => {
  const f = path.join(dist, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const t = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(f)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": t }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const FIX = {
  ephemeral: { phonetic: "/əˈfɛm(ə)ɹəl/", audio: "https://example.test/e.mp3", def: "Lasting for a very short time.", ex: "Fame is ephemeral.", syn: ["fleeting"], ant: ["permanent"] },
  lucid: { def: "Clearly expressed; easy to understand.", ex: "A lucid explanation." },
  terse: { def: "Using few words; abrupt.", ex: "A terse reply." },
  banal: { def: "Lacking originality; obvious.", ex: "A banal remark." },
  arcane: { def: "Understood by few; mysterious.", ex: "Arcane rituals." },
  sonder: { def: "x", skip: true },
};
let failures = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); if (!cond) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
let dictMode = "ok"; // ok | offline | ratelimit
const dictRoute = (route) => {
  const w = decodeURIComponent(route.request().url().split("/").pop());
  if (dictMode === "offline") return route.abort("internetdisconnected");
  if (dictMode === "ratelimit") return route.fulfill({ status: 429, body: "{}" });
  const f = FIX[w];
  if (!f || f.skip) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ title: "No Definitions Found" }) });
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ word: w, phonetic: f.phonetic, phonetics: f.audio ? [{ text: f.phonetic, audio: f.audio }] : [], meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: f.def, example: f.ex }], synonyms: f.syn ?? [], antonyms: f.ant ?? [] }] }]) });
};
await ctx.route("https://api.dictionaryapi.dev/**", dictRoute);

await page.goto(base);
// 1 onboarding on a fresh profile
await page.waitForSelector("dialog[open]");
check("onboarding shown to new user", await page.locator("dialog.onboarding[open]").count() === 1);
await page.screenshot({ path: `${shots}/vovel-1-onboarding.png` });
await page.getByRole("button", { name: "Skip" }).click();
check("onboarding dismissed", await page.locator("dialog[open]").count() === 0);
check("empty state invites first word", await page.getByText("Find your words.").first().isVisible());
await page.reload();
check("onboarding not shown again after skip", await page.locator("dialog[open]").count() === 0);

// 2 search + view + save
await page.locator("#top-q").fill("ephemeral");
await page.locator(".topsearch").getByRole("button", { name: "Search" }).click();
await page.waitForSelector("article.entry");
check("definition shown", await page.getByText("Lasting for a very short time.").isVisible());
check("source labelled as dictionary", await page.getByText(/From Free Dictionary API/).isVisible());
check("audio control present", await page.locator("audio").count() === 1);
await page.getByLabel(/Where did you meet it/).fill("The ephemeral beauty of cherry blossom.");
await page.getByLabel("Personal note").fill("novel I'm reading");
await page.getByLabel("Source / book title").fill("Snow Country");
await page.getByRole("button", { name: "Save to My Words" }).click();
await page.waitForSelector(".banner-ok");
check("save success state", await page.getByText("Saved to My Words.").first().isVisible());
await page.screenshot({ path: `${shots}/vovel-2-saved.png`, fullPage: true });

// 3 persistence
await page.reload();
await page.goto(base + "#/words");
await page.waitForSelector(".word-row");
check("word persists after reload", (await page.locator(".word-row").count()) === 1);

// 4 duplicate
await page.goto(base + "#/discover/Ephemeral");
await page.waitForSelector(".banner-info");
check("duplicate shows existing entry + open link", await page.getByRole("link", { name: "Open saved entry" }).isVisible());
check("no second save button for duplicate", await page.getByRole("button", { name: "Save to My Words" }).count() === 0);

// 5 sentence capture
await page.goto(base + "#/discover");
await page.locator("#q").fill("She gave a terse reply to the question.");
await page.locator("form.searchbar button").click();
await page.waitForSelector(".chips");
await page.getByRole("button", { name: "terse" }).click();
await page.waitForSelector("article.entry");
check("sentence kept as context", (await page.getByLabel(/Where did you meet it/).inputValue()).includes("terse reply"));
await page.getByRole("button", { name: "Save to My Words" }).click();
await page.waitForSelector(".banner-ok");
for (const w of ["lucid", "banal", "arcane"]) {
  await page.goto(base + `#/discover/${w}`);
  await page.waitForSelector("article.entry");
  await page.getByRole("button", { name: "Save to My Words" }).click();
  await page.waitForSelector(".banner-ok");
}

// 6 error states
await page.goto(base + "#/discover/zzzxq");
await page.waitForSelector(".banner-warn");
check("unknown word handled, never invented", await page.getByText(/No dictionary entry was found/).isVisible());
check("manual definition clearly labelled as yours", await page.getByText(/your definition/).isVisible());
dictMode = "offline";
await page.goto(base + "#/discover/gregarious");
await page.waitForSelector(".banner-warn");
check("network error handled", await page.getByText(/Could not reach the dictionary/).isVisible());
dictMode = "ratelimit";
await page.goto(base + "#/discover/loquacious");
await page.waitForSelector(".banner-warn");
check("rate limit handled", await page.getByText(/rate-limiting/).isVisible());
dictMode = "ok";

// 7 word detail: notes, collection, status
await page.goto(base + "#/collections");
await page.getByLabel("New collection name").fill("Literature");
await page.getByRole("button", { name: "Create" }).click();
await page.getByRole("link", { name: "Literature" }).waitFor();
await page.goto(base + "#/words");
await page.getByRole("link", { name: /ephemeral/ }).first().click();
await page.waitForSelector("h1.entry-word");
await page.getByLabel("Your own example sentence").fill("Autumn light is ephemeral.");
await page.getByLabel("Personal notes").fill("from chapter two");
await page.getByRole("button", { name: "Save notes" }).click();
await page.getByText("Notes saved.").waitFor();
await page.getByLabel("Collection").selectOption({ label: "Literature" });
await page.getByText("Collection updated.").waitFor();
await page.getByLabel("Status").selectOption("learning");
await page.getByText("Status updated.").waitFor();
await page.reload();
await page.waitForSelector("h1.entry-word");
await page.waitForFunction(() => document.querySelector("textarea") && [...document.querySelectorAll("textarea")].some((t) => t.value));
check("notes persist", (await page.getByLabel("Personal notes").inputValue()) === "from chapter two");
check("collection persists", (await page.getByLabel("Collection").inputValue()) !== "");
check("status persists", (await page.getByLabel("Status").inputValue()) === "learning");
// delete collection keeps word
await page.goto(base + "#/collections");
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByRole("button", { name: "Delete collection" }).click();
await page.getByText(/Words kept/).waitFor();
await page.goto(base + "#/words");
check("deleting a collection keeps its words", (await page.locator(".word-row").count()) === 5);

// 8 Daily Five
await page.goto(base + "#/daily");
await page.getByRole("button", { name: "Start session" }).click();
await page.screenshot({ path: `${shots}/vovel-3-recall.png` });
check("recall prompt shown before definition", await page.getByText(/Try to recall it first/).isVisible());
check("progress shown", await page.getByText("1 of 5").isVisible());
const order = [];
for (let i = 0; i < 5; i++) {
  order.push(await page.locator(".flash-word").innerText());
  await page.getByRole("button", { name: "Reveal meaning" }).click();
  if (i === 0) await page.screenshot({ path: `${shots}/vovel-4-revealed.png` });
  const rating = ["Good", "Again", "Easy", "Hard", "Good"][i];
  await page.getByRole("button", { name: new RegExp("^" + rating) }).click();
}
await page.getByText("Session complete").waitFor();
check("summary after session", await page.getByText("reviewed").first().isVisible());
await page.screenshot({ path: `${shots}/vovel-5-summary.png` });
await page.reload();
await page.goto(base + "#/daily");
await page.getByText("Today’s session is complete").waitFor();
check("completed session can be revisited without new reviews", await page.getByRole("button", { name: /Reveal|Start/ }).count() === 0);
await page.goto(base + "#/");
await page.waitForSelector(".stats");
const stat = async (label) => (await page.locator(".stat", { hasText: label }).locator("b").innerText()).trim();
check("dashboard: total words", (await stat("words saved")) === "5");
check("dashboard: streak 1", (await stat("day streak")) === "1");
check("dashboard: Daily Five 5/5", (await stat("Daily Five today")) === "5/5");
check("dashboard: learned this week = 4 (all but the 'Again')", (await stat("learned this week")) === "4");
await page.screenshot({ path: `${shots}/vovel-6-home.png`, fullPage: true });
const barTotals = (await page.locator(".bar-n").allInnerTexts()).map(Number).reduce((a, b) => a + b, 0);
check("activity chart sums to 5 reviews", barTotals === 5);

// 9 review page
await page.goto(base + "#/review");
await page.waitForSelector(".stat-row");
check("review centre lists learning words", (await page.getByRole("heading", { name: /Currently learning/ }).isVisible()));
const studyAhead = page.getByRole("link", { name: "Study ahead" }).first();
if (await studyAhead.count()) {
  await studyAhead.click();
  await page.getByRole("button", { name: "Reveal meaning" }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await page.getByText("Practice complete").waitFor();
  check("study-ahead explained as non-scheduling", await page.getByText(/didn’t change the word’s schedule/).isVisible());
}

// 10 words to use + export + import preview
await page.goto(base + "#/use");
await page.locator("#practice select").selectOption({ label: "lucid" });
await page.getByLabel("Write a sentence using it").fill("Her lucid argument won the room.");
await page.getByRole("button", { name: "Check", exact: true }).click();
check("writing check is honest about limits", await page.getByText(/can’t judge grammar/).isVisible());
await page.goto(base + "#/settings");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
const backupPath = `${shots}/vovel-backup.json`;
await dl.saveAs(backupPath);
const exported = JSON.parse(fs.readFileSync(backupPath, "utf8"));
check("JSON export has all words", exported.words.length === 5 && exported.app === "vovel");
const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
check("CSV export downloads", dl2.suggestedFilename().endsWith(".csv"));
await page.locator("input[type=file]").setInputFiles(backupPath);
await page.getByRole("region", { name: "Import preview" }).waitFor();
check("import preview shows duplicates skipped, nothing applied", await page.getByText(/5 duplicates will be skipped/).isVisible());
await page.screenshot({ path: `${shots}/vovel-7-settings.png`, fullPage: true });
await page.getByRole("button", { name: "Cancel" }).click();

// 11 destructive confirm
await page.getByRole("button", { name: /Erase all local data/ }).click();
await page.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
await page.goto(base + "#/words");
check("cancelling reset keeps data", (await page.locator(".word-row").count()) === 5);
await page.goto(base + "#/settings");
await page.getByRole("button", { name: /Erase all local data/ }).click();
await page.locator("dialog[open]").getByRole("button", { name: "Erase everything" }).click();
await page.getByText("All local data erased.").waitFor();
await page.goto(base + "#/words");
check("reset erases after confirmation", await page.getByText("Your word archive is empty").isVisible());
// restore from backup
await page.goto(base + "#/settings");
await page.locator("input[type=file]").setInputFiles(backupPath);
await page.getByRole("button", { name: "Confirm import" }).click();
await page.getByText("Import finished.").waitFor();
await page.goto(base + "#/words");
check("backup restores words", (await page.locator(".word-row").count()) === 5);

// 12 mobile
const m = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
await m.route("https://api.dictionaryapi.dev/**", dictRoute);
const mp = await m.newPage();
await mp.goto(base);
await mp.waitForSelector("dialog[open]");
await mp.getByRole("button", { name: "Skip" }).click();
check("mobile: tab bar visible, sidebar hidden", (await mp.locator(".tabbar").isVisible()) && !(await mp.locator(".sidebar").isVisible()));
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("mobile: no horizontal scroll", !overflow);
await mp.screenshot({ path: `${shots}/vovel-8-mobile-home.png` });
await mp.goto(base + "#/discover/ephemeral");
await mp.waitForSelector("article.entry");
await mp.screenshot({ path: `${shots}/vovel-9-mobile-entry.png` });
const ov2 = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("mobile: entry page has no horizontal scroll", !ov2);

check("no uncaught page errors / console errors", errors.length === 0, errors.join(" | "));
await browser.close(); server.close();
console.log(failures === 0 ? "\nE2E: ALL PASSED" : `\nE2E: ${failures} FAILED`);
process.exit(failures ? 1 : 0);
