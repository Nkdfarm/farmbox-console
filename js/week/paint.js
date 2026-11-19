// paint: the toolbars, the people column and the body in one pass
import { el, pageHead } from '../ui.js';
import { planButton } from './people.js';
import { filterBar, navBar } from './toolbar.js';
import { paintBody } from './views.js';
import { newTask } from './actions.js';
import { S } from './state.js';

// ── the page ───────────────────────────────────────────────────────────────
export function paint() {
  S.mount.textContent = '';

  // a task by hand, once or every n days (FarmBox 0262): the Admin and the Farm manager
  let nb = null;
  if (S.data?.may_add_tasks) {
    nb = el('button', 'btn btn-primary', '+ New task');
    nb.onclick = () => newTask(S.span === 'day' ? S.day : null);
  }
  // the head through pageHead (19 Nov 2026): its buttons go to the shell's actions row like every page's
  S.mount.append(pageHead(null, 'Every task of the FarmBox, day by day: what, where, who. Click a task to open it, change who does it or mark it done.',
    nb, planButton()));

  const layout = el('div', 'tk-layout');
  S.peopleCol = el('aside', 'tk-people');
  const main = el('div', 'tk-main');
  main.append(filterBar());
  main.append(navBar());
  S.body = el('div');
  main.append(S.body);
  layout.append(S.peopleCol, main);
  S.mount.append(layout);
  paintBody();
}
