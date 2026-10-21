// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// Uses a temporary browser context; never connects to a personal browser profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const taskKey = 'my-first-website-todos-v1';
const goalKey = 'my-first-website-goals-v1';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const today = '2026-10-19';
const fixtures = [
  { name: '目标甲 Goal A', description: '描述 Description', dueDate: '', extra: 'preserve', subtasks: [
    { text: '今天高 Today high', done: false, priority: 'high', dueDate: today },
    { text: '逾期高 Overdue high', done: false, priority: 'high', dueDate: '2026-10-17' },
    { text: '已完成今天 Completed today', done: true, priority: 'high', dueDate: today },
    { text: '旧子任务 Legacy', done: false, extra: 42 },
    { text: '无日期高 No date high', done: false, priority: 'high', dueDate: '' }
  ] },
  { name: '目标乙 Goal B', description: '', dueDate: '', subtasks: [
    { text: '今天中 Today medium', done: false, priority: 'medium', dueDate: today },
    { text: '明天高 Tomorrow high', done: false, priority: 'high', dueDate: '2026-10-20' },
    { text: '较早逾期高 Earlier overdue', done: false, priority: 'high', dueDate: '2026-10-16' },
    { text: '已完成逾期 Completed overdue', done: true, priority: 'low', dueDate: '2026-10-15' }
  ] },
  { name: '旧空目标 Empty legacy goal', description: '' }
];
let browser, server;
const contexts = [];
const errors = [];
async function main() {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  async function setup(goals, viewport = { width: 1280, height: 900 }, tasks = [{ text: '独立普通任务', done: false, dueDate: today, priority: 'high' }]) {
    const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', viewport });
    contexts.push(context);
    await context.addInitScript(() => {
      window.storageWrites = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        window.storageWrites.push(key);
        return original.call(this, key, value);
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // UTC is still October 18; the device's local date is October 19.
    await page.clock.install({ time: new Date('2026-10-18T16:15:00Z') });
    await page.goto(url);
    await page.evaluate(({ goals, goalKey, taskKey, tasks }) => {
      localStorage.setItem(goalKey, JSON.stringify(goals));
      localStorage.setItem(taskKey, JSON.stringify(tasks));
    }, { goals, goalKey, taskKey, tasks });
    await page.reload();
    return page;
  }
  async function counts(page) {
    return page.locator('.dashboard .stats strong').allTextContents();
  }
  async function checkLayout(page, width) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Horizontal overflow at ${width}px`);
    const overflowing = await page.locator('.dashboard-task, .goal-card, .dashboard .stat').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1).map(n => n.className));
    assert.deepEqual(overflowing, [], `Card/text overflow at ${width}px`);
    const cards = await page.locator('#goal-list .goal-card').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { l:r.left, r:r.right, t:r.top, b:r.bottom }; }));
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      assert.equal(a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t, false, 'Overlapping goal cards');
    }
  }
  const page = await setup(fixtures);
  assert.deepEqual(await counts(page), ['3', '2', '2', '2']);
  assert.equal(await page.locator('#dashboard-date').textContent(), today);
  assert.equal(await page.locator('#goal-list').count(), 1);
  assert.equal(await page.locator('#goal-list .goal-card').count(), 3);
  assert.match(await page.locator('#goal-list .goal-card').nth(0).textContent(), /20%/);
  assert.match(await page.locator('#goal-list .goal-card').nth(1).textContent(), /25%/);
  assert.match(await page.locator('#goal-list .goal-card').nth(2).textContent(), /0%/);
  assert.deepEqual(await page.locator('#dashboard-today-list strong').allTextContents(), ['今天高 Today high', '今天中 Today medium']);
  assert.deepEqual(await page.locator('#dashboard-focus-list strong').allTextContents(), ['较早逾期高 Earlier overdue', '逾期高 Overdue high', '今天高 Today high', '明天高 Tomorrow high', '无日期高 No date high']);
  assert.deepEqual(await page.evaluate(() => window.storageWrites), []);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), goalKey), JSON.stringify(fixtures));
  for (const width of [1280, 768, 390, 320]) await checkLayout(page, width);
  if (process.env.DASHBOARD_ARTIFACTS) {
    fs.mkdirSync(process.env.DASHBOARD_ARTIFACTS, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(process.env.DASHBOARD_ARTIFACTS, 'dashboard-mobile.png'), fullPage: true });
    await page.screenshot({ path: path.join(process.env.DASHBOARD_ARTIFACTS, 'dashboard-mobile-top.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(process.env.DASHBOARD_ARTIFACTS, 'dashboard-desktop.png') });
  }
  // Open the correct goal from a dashboard task and complete its subtask.
  await page.locator('#dashboard-today-list button').nth(1).click();
  assert.equal(await page.locator('#goal-detail-title').textContent(), fixtures[1].name);
  await page.locator('#subtask-list input[type=checkbox]').first().check();
  await page.locator('#goal-back').click();
  assert.deepEqual(await counts(page), ['3', '1', '3', '2']);
  assert.match(await page.locator('#goal-list .goal-card').nth(1).textContent(), /50%/);
  await page.reload();
  assert.deepEqual(await counts(page), ['3', '1', '3', '2']);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0].text, taskKey), '独立普通任务');
  // Focus entry opens goal A; editing preserves completion and refreshes dashboard.
  await page.locator('#dashboard-focus-list button').nth(1).click();
  assert.equal(await page.locator('#goal-detail-title').textContent(), fixtures[0].name);
  await page.locator('#subtask-filter-priority').selectOption('high');
  await page.locator('#subtask-filter-date').selectOption('overdue');
  assert.equal(await page.locator('#subtask-list li').count(), 1);
  await page.locator('#subtask-list .edit-button').click();
  await page.locator('#subtask-edit-date').fill(today);
  await page.locator('#subtask-edit-form button[type=submit]').click();
  await page.locator('#goal-back').click();
  assert.deepEqual(await counts(page), ['3', '2', '3', '1']);
  // Legacy record defaults and extra fields survive explicit saves.
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), goalKey);
  assert.equal(saved[0].extra, 'preserve');
  assert.deepEqual(saved[0].subtasks[3], { text:'旧子任务 Legacy', done:false, extra:42, priority:'medium', dueDate:'' });
  // Deletion still requires confirmation, and goal data remains isolated.
  await page.locator('#goal-list .goal-card').nth(1).locator('button').click();
  const before = await page.evaluate(key => localStorage.getItem(key), goalKey);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#subtask-list .delete-button').first().click();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), goalKey), before);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#subtask-list .delete-button').first().click();
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), goalKey);
  assert.deepEqual(after[0], saved[0]);
  assert.equal(after[1].subtasks.length, 3);
  await page.locator('#goal-back').click();
  // Original task edit/filter/sort/add still work.
  await page.locator('#todo-list .edit-button').first().click();
  await page.locator('#edit-text').fill('普通任务已编辑');
  await page.locator('#edit-form button[type=submit]').click();
  await page.locator('#filter-category').selectOption('work');
  await page.locator('#filter-status').selectOption('pending');
  await page.locator('#sort-order').selectOption('priority');
  assert.equal(await page.locator('#todo-list li').count(), 1);
  await page.locator('#todo-input').fill('新增普通任务');
  await page.locator('#todo-form button[type=submit]').click();
  assert.equal(await page.locator('#todo-list li').count(), 2);
  // No goals and no subtasks always show zero, without writing defaults.
  const empty = await setup([]);
  assert.deepEqual(await counts(empty), ['0', '0', '0', '0']);
  assert.equal(await empty.locator('#dashboard-today-empty').isVisible(), true);
  assert.equal(await empty.locator('#dashboard-focus-empty').isVisible(), true);
  const bare = await setup([{ name:'旧目标', description:'' }]);
  assert.deepEqual(await counts(bare), ['1', '0', '0', '0']);
  assert.deepEqual(await bare.evaluate(() => window.storageWrites), []);
  await bare.locator('#goal-list button').click();
  await bare.locator('#subtask-text').fill('今天新子任务');
  await bare.locator('#subtask-date').fill(today);
  await bare.locator('#subtask-priority').selectOption('high');
  await bare.locator('#subtask-form button[type=submit]').click();
  await bare.locator('#goal-back').click();
  assert.deepEqual(await counts(bare), ['1', '1', '0', '0']);
  await bare.locator('#goal-name').fill('新建空目标');
  await bare.locator('#goal-form button[type=submit]').click();
  assert.deepEqual(await counts(bare), ['2', '1', '0', '0']);
  await bare.reload();
  assert.deepEqual(await counts(bare), ['2', '1', '0', '0']);
  // A corrupt stored value must remain untouched and show an honest error.
  const corrupt = await setup([]);
  await corrupt.evaluate(key => localStorage.setItem(key, 'broken data'), goalKey);
  await corrupt.reload();
  assert.match(await corrupt.locator('#dashboard-status').textContent(), /统计不可用/);
  assert.equal(await corrupt.evaluate(key => localStorage.getItem(key), goalKey), 'broken data');
  assert.deepEqual(await corrupt.evaluate(() => window.storageWrites), []);
  // Long content on narrow screens, including detail forms and edit dialog.
  const long = await setup([{ name:'长目标'.repeat(60), description:'描述'.repeat(100), subtasks:[{ text:'LongUnbrokenTaskName'.repeat(25), done:false, priority:'high', dueDate:today }] }], { width:320, height:900 });
  await checkLayout(long, 320);
  await long.locator('#dashboard-today-list button').click();
  await checkLayout(long, 320);
  await long.locator('#subtask-list .edit-button').click();
  assert.equal(await long.locator('#subtask-edit-dialog').evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
  await long.locator('#subtask-edit-cancel').click();
  // Crossing local midnight recalculates without any storage writes.
  const midnight = await setup(fixtures);
  await midnight.clock.setSystemTime(new Date('2026-10-19T16:01:00Z'));
  await midnight.evaluate(() => refreshDashboardDate());
  assert.equal(await midnight.locator('#dashboard-date').textContent(), '2026-10-20');
  assert.deepEqual(await counts(midnight), ['3', '1', '2', '5']);
  assert.deepEqual(await midnight.evaluate(() => window.storageWrites), []);
  // Overdue alone includes both sources. All other dashboard metrics stay goal-only.
  const standalone = [
    { text:'独立逾期', done:false, dueDate:'2026-10-18' },
    { text:'独立已完成逾期', done:true, dueDate:'2026-10-17' },
    { text:'独立今天', done:false, dueDate:today },
    { text:'独立未来', done:false, dueDate:'2026-10-20' },
    { text:'独立旧无日期', done:false, extra:'keep' },
    { text:'独立空日期', done:false, dueDate:'' }
  ];
  const mixed = await setup(fixtures, { width:390, height:844 }, standalone);
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '3']);
  assert.equal(await mixed.evaluate(key => localStorage.getItem(key), taskKey), JSON.stringify(standalone));
  assert.equal(await mixed.evaluate(key => localStorage.getItem(key), goalKey), JSON.stringify(fixtures));
  assert.deepEqual(await mixed.evaluate(() => window.storageWrites), []);
  const progressBefore = await mixed.locator('#goal-list progress').evaluateAll(nodes => nodes.map(n => n.value));
  await mixed.locator('#todo-list input[type=checkbox]').first().check();
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '2']);
  await mixed.locator('#todo-list input[type=checkbox]').first().uncheck();
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '3']);
  await mixed.locator('#todo-list .edit-button').first().click();
  await mixed.locator('#edit-date').fill(today);
  await mixed.locator('#edit-form button[type=submit]').click();
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '2']);
  await mixed.locator('#todo-input').fill('新增独立逾期');
  await mixed.locator('#task-date').fill('2026-10-18');
  await mixed.locator('#todo-form button[type=submit]').click();
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '3']);
  await mixed.reload();
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '3']);
  await mixed.locator('#todo-list .delete-button').last().click();
  assert.deepEqual(await counts(mixed), ['3', '2', '2', '2']);
  assert.deepEqual(await mixed.locator('#goal-list progress').evaluateAll(nodes => nodes.map(n => n.value)), progressBefore);
  assert.equal(await mixed.evaluate(key => localStorage.getItem(key), goalKey), JSON.stringify(fixtures));
  const standaloneOnly = await setup([], { width:320, height:900 }, standalone);
  assert.deepEqual(await counts(standaloneOnly), ['0', '0', '0', '1']);
  await checkLayout(standaloneOnly, 320);
  const goalsOnly = await setup(fixtures, { width:1280, height:900 }, []);
  assert.deepEqual(await counts(goalsOnly), ['3', '2', '2', '2']);
  // Identical names in separate records remain distinct; missing old fields are safe.
  const legacyOverdue = [{ name:'旧目标', description:'', subtasks:[
    { text:'同名任务', done:false, dueDate:'2026-10-18' },
    { text:'已完成旧子任务', done:true, dueDate:'2026-10-18' },
    { text:'旧无日期子任务', done:false }
  ] }];
  const legacyMixed = await setup(legacyOverdue, { width:1280, height:900 }, [{text:'同名任务',done:false,dueDate:'2026-10-18'}]);
  assert.deepEqual(await counts(legacyMixed), ['1', '0', '1', '2']);
  assert.deepEqual(await legacyMixed.evaluate(() => window.storageWrites), []);
  assert.equal(await legacyMixed.evaluate(key => localStorage.getItem(key), goalKey), JSON.stringify(legacyOverdue));
  assert.deepEqual(errors, []);
  console.log('PASS: Edge browser; empty/legacy/cross-goal statistics; priority/date rules; detail navigation; completion/edit/delete confirmation; filters; refresh persistence; storage isolation/order/no-write-on-read; original task controls; local timezone/midnight; 320/390/768/1280px layouts and long text.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const context of contexts) await context.close();
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
