// S1 scenario catalog. Used by the recorder page (manual steps) and by the automation
// drivers in scripts/s1/ (Node imports this file directly via type stripping, so keep it
// to erasable TypeScript: no enums, no namespaces, no parameter properties).

export const SITE = 'http://localhost:8765';
export const OTHER_ORIGIN = 'http://127.0.0.1:8765';

export type Step =
  | { op: 'goto'; url: string } // address bar / typed navigation
  | { op: 'click'; sel: string; newTab?: boolean } // left click; newTab when it opens one
  | { op: 'middle'; sel: string } // middle click → background tab
  | { op: 'back' }
  | { op: 'forward' }
  | { op: 'reload' }
  | { op: 'wait'; ms: number }
  | { op: 'duplicate' } // tabs.duplicate on the current tab
  | { op: 'close' } // close the current tab
  | { op: 'restore' } // sessions.restore() — what Ctrl+Shift+T does
  | { op: 'switch'; to: 'previous' | 'newest' }; // activate another scenario tab

export interface Scenario {
  id: string;
  title: string;
  covers: string[]; // SPEC question ids / sections this scenario informs
  auto: boolean; // false = manual only (browser UI, restart, keyboard shortcuts)
  steps: Step[];
  manual: string[]; // human-readable steps, shown on the recorder page
}

const u = (p: string) => SITE + p;

export const SCENARIOS: Scenario[] = [
  {
    id: 'link-chain',
    title: 'Follow two links',
    covers: ['§6.1'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-b' }, { op: 'click', sel: '#to-c' }],
    manual: ['Open /a', 'Click "to B"', 'Click "to C"'],
  },
  {
    id: 'back-forward',
    title: 'Back, back, forward',
    covers: ['B3', '§6.3'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/a') },
      { op: 'click', sel: '#to-b' },
      { op: 'click', sel: '#to-c' },
      { op: 'back' },
      { op: 'back' },
      { op: 'forward' },
    ],
    manual: ['Open /a', 'Click "to B"', 'Click "to C"', 'Back', 'Back', 'Forward'],
  },
  {
    id: 'branch',
    title: 'Back, then a different link (the branch case)',
    covers: ['§5.2', 'B3'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/a') },
      { op: 'click', sel: '#to-b' },
      { op: 'click', sel: '#to-c' },
      { op: 'back' },
      { op: 'click', sel: '#to-d' },
      { op: 'back' },
      { op: 'back' },
    ],
    manual: ['Open /a', 'Click "to B"', 'Click "to C"', 'Back (on B)', 'Click "to D"', 'Back', 'Back'],
  },
  {
    id: 'revisit',
    title: 'Reach the same URL again by a link',
    covers: ['B2'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/a') },
      { op: 'click', sel: '#to-b' },
      { op: 'click', sel: '#to-a' },
      { op: 'click', sel: '#to-b' },
      { op: 'back' },
    ],
    manual: ['Open /a', 'Click "to B"', 'Click "to A"', 'Click "to B"', 'Back'],
  },
  {
    id: 'typed-in-tab',
    title: 'Typed URL inside an existing tab',
    covers: ['B8'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-b' }, { op: 'goto', url: u('/c') }, { op: 'back' }],
    manual: ['Open /a', 'Click "to B"', 'Type /c into the address bar', 'Back'],
  },
  {
    id: 'redirect-server',
    title: '302 redirect',
    covers: ['B4'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-r302' }, { op: 'back' }],
    manual: ['Open /a', 'Click "302 → B"', 'Back'],
  },
  {
    id: 'redirect-js',
    title: 'JavaScript location.replace redirect',
    covers: ['B4'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-rjs' }, { op: 'wait', ms: 800 }, { op: 'back' }],
    manual: ['Open /a', 'Click "JS redirect → C"', 'Wait for C', 'Back'],
  },
  {
    id: 'redirect-meta',
    title: 'Meta refresh redirect',
    covers: ['B4'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-rmeta' }, { op: 'wait', ms: 1500 }, { op: 'back' }],
    manual: ['Open /a', 'Click "meta refresh → D"', 'Wait for D', 'Back'],
  },
  {
    id: 'spa',
    title: 'pushState, replaceState and fragments in an SPA',
    covers: ['B5', 'B6', '§6.2'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/spa') },
      { op: 'click', sel: '#push-p1' },
      { op: 'click', sel: '#push-p2q' },
      { op: 'click', sel: '#replace-p3' },
      { op: 'click', sel: '#frag' },
      { op: 'back' },
      { op: 'back' },
      { op: 'back' },
    ],
    manual: ['Open /spa', 'Click "push /spa/p1"', 'Click "push /spa/p2?q=x"', 'Click "replace /spa/p3"', 'Click "#sec"', 'Back ×3'],
  },
  {
    id: 'spa-replace',
    title: 'Tell pushState from replaceState, incl. same-URL calls (S1b)',
    covers: ['B5', 'S1b'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/spa') },
      { op: 'click', sel: '#push-p1' },
      { op: 'click', sel: '#replace-same' },
      { op: 'click', sel: '#push-same' },
      { op: 'click', sel: '#replace-p3' },
      { op: 'back' },
      { op: 'back' },
      { op: 'back' },
    ],
    manual: [
      'Open /spa',
      'Click "push /spa/p1"',
      'Click "replace (same URL)"',
      'Click "push (same URL)"',
      'Click "replace /spa/p3"',
      'Back ×3',
    ],
  },
  {
    id: 'fragment',
    title: 'In-page anchor on a normal page',
    covers: ['B6'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-frag' }, { op: 'back' }],
    manual: ['Open /a', 'Click "#section"', 'Back'],
  },
  {
    id: 'reload',
    title: 'Reload',
    covers: ['B7'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-b' }, { op: 'reload' }],
    manual: ['Open /a', 'Click "to B"', 'Reload (F5)'],
  },
  {
    id: 'form',
    title: 'POST and GET forms',
    covers: ['B14'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/form') },
      { op: 'click', sel: '#post-submit' },
      { op: 'click', sel: '#to-form' },
      { op: 'click', sel: '#get-submit' },
    ],
    manual: ['Open /form', 'Submit the POST form', 'Click "forms"', 'Submit the GET form'],
  },
  {
    id: 'target-blank',
    title: 'Link with target=_blank, with and without noopener',
    covers: ['B9', '§5.3'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/newtab') },
      { op: 'click', sel: '#blank', newTab: true },
      { op: 'switch', to: 'previous' },
      { op: 'click', sel: '#blank-noopener', newTab: true },
    ],
    manual: ['Open /newtab', 'Click "_blank → B"', 'Go back to the /newtab tab', 'Click "_blank noopener → C"'],
  },
  {
    id: 'middle-click',
    title: 'Middle click opens a background tab',
    covers: ['B9', 'D2'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'middle', sel: '#to-b' }, { op: 'wait', ms: 800 }, { op: 'switch', to: 'newest' }],
    manual: ['Open /a', 'Middle-click "to B"', 'Switch to the new tab'],
  },
  {
    id: 'window-open',
    title: 'window.open from script',
    covers: ['B9'],
    auto: true,
    steps: [{ op: 'goto', url: u('/newtab') }, { op: 'click', sel: '#winopen', newTab: true }],
    manual: ['Open /newtab', 'Click "window.open → D"'],
  },
  {
    id: 'cross-origin',
    title: 'Link to another origin and back',
    covers: ['§6.1'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-other' }, { op: 'click', sel: '#to-b' }, { op: 'back' }, { op: 'back' }],
    manual: ['Open /a', 'Click "other origin → A"', 'Click "to B"', 'Back', 'Back'],
  },
  {
    id: 'duplicate',
    title: 'Duplicate a tab',
    covers: ['B13'],
    auto: true,
    steps: [{ op: 'goto', url: u('/a') }, { op: 'click', sel: '#to-b' }, { op: 'duplicate' }, { op: 'wait', ms: 800 }, { op: 'back' }],
    manual: ['Open /a', 'Click "to B"', 'Right-click the tab → Duplicate', 'In the duplicate: Back'],
  },
  {
    id: 'close-restore',
    title: 'Close a tab and restore it',
    covers: ['B11'],
    auto: true,
    steps: [
      { op: 'goto', url: u('/a') },
      { op: 'click', sel: '#to-b' },
      { op: 'close' },
      { op: 'wait', ms: 500 },
      { op: 'restore' },
      { op: 'wait', ms: 1000 },
      { op: 'back' },
    ],
    manual: ['Open /a', 'Click "to B"', 'Close the tab', 'Ctrl+Shift+T', 'Back'],
  },
  {
    id: 'address-bar-search',
    title: 'Search from the address bar in an existing tab',
    covers: ['B8', 'C1'],
    auto: false,
    steps: [],
    manual: ['Open /a', 'Type "dude spike test" into the address bar, press Enter', 'Click the first result', 'Back', 'Back'],
  },
  {
    id: 'bookmark',
    title: 'Open a bookmark in an existing tab',
    covers: ['B8'],
    auto: false,
    steps: [],
    manual: ['Before pressing Start: open /c and bookmark it (Ctrl+D)', 'Open /a', 'Open the /c bookmark in this tab (bookmarks menu or toolbar)'],
  },
  {
    id: 'ctrl-shift-t',
    title: 'Undo close tab with the real shortcut',
    covers: ['B11'],
    auto: false,
    steps: [],
    manual: ['Open /a', 'Click "to B"', 'Ctrl+W', 'Ctrl+Shift+T', 'Back'],
  },
  {
    id: 'move-window',
    title: 'Drag a tab into its own window and back',
    covers: ['B10'],
    auto: false,
    steps: [],
    manual: ['Open /a in a second tab', 'Drag that tab out into a new window', 'Click "to B" there', 'Drag it back into the first window'],
  },
  {
    id: 'restart',
    title: 'Browser restart with session restore',
    covers: ['B12', 'R2'],
    auto: false,
    steps: [],
    manual: [
      'Make sure "Open previous windows and tabs" (Firefox) / "Continue where you left off" (Chrome) is on',
      'Open /a → "to B" in one tab and /c in another',
      'Press "End" here, then quit the browser completely',
      'Start the browser again, open this page, press "Start" with the same scenario, then Back in the B tab, then "End"',
    ],
  },
  {
    id: 'tab-switching',
    title: 'Switch tabs and windows (dwell time, focus)',
    covers: ['C1'],
    auto: false,
    steps: [],
    manual: ['Open /a and /b in two tabs', 'Switch between them a few times', 'Open a second window, focus it, focus back'],
  },
];
