// 遊び方のページ
import './style.css';
import { CARDS, KIND_NAMES, MONTH_NAMES } from './game/cards';
import { cardUrl } from './ui/art';
import { h } from './ui/dom';

const sec = (title: string, ...body: (HTMLElement | string | null)[]) => h('section', { class: 'panel' }, h('h2', {}, title), ...body);
const ul = (items: string[]) => h('ul', { class: 'rule-list' }, items.map((x) => h('li', {}, x)));
const yaku = (name: string, pts: string, desc: string, cards: number[]) => h('li', { class: 'yaku-rule' },
  h('div', {}, h('b', {}, name), h('span', { class: 'pt' }, pts)), h('p', {}, desc),
  h('div', { class: 'mini' }, cards.map((c) => h('img', { src: cardUrl(c), alt: CARDS[c].name, title: CARDS[c].name }))));
const ids = (...names: string[]) => names.map((n) => CARDS.find((c) => c.name === n)!.id);

document.getElementById('rules')!.replaceWith(h('main', { class: 'title-main rules' },
  h('a', { href: '/', class: 'link' }, '← ゲームに戻る'),
  h('h1', {}, '遊び方'),
  sec('こいこいの流れ',
    ul([
      '2 人で遊びます。手札 8 枚、場に 8 枚を配り、残りが山になります。親から始めます',
      '自分の番：① 手札から 1 枚出し、場に同じ月の札があれば合わせて取ります（なければ場に置きます）。② 山から 1 枚めくり、同じように合わせます',
      '同じ月の札が場に 2 枚あるときは、どちらを取るか選びます。3 枚あるときは 4 枚まとめて取れます',
      '取った札で「役」ができたら、「勝負（上がる）」か「こいこい（続ける）」を選びます。こいこいした後に相手が先に上がると、相手の点が倍になります',
      'どちらも役を作れずに手札がなくなったら「流れ」で、点は入りません',
      '配った手札に同じ月が 4 枚（手四）、または同じ月 2 枚が 4 組（くっつき）なら、すぐに 6 点で上がりです',
      '決めた月数（3・6・12 か月）を遊び、合計の点で勝ち負けを決めます。勝った人が次の月の親です',
    ])),
  sec('役',
    h('ul', { class: 'yaku-rules' },
      yaku('五光', '10 点', '光札 5 枚すべて', ids('松に鶴', '桜に幕', '芒に月', '柳に小野道風', '桐に鳳凰')),
      yaku('四光', '8 点', '柳以外の光札 4 枚', ids('松に鶴', '桜に幕', '芒に月', '桐に鳳凰')),
      yaku('雨四光', '7 点', '柳を含む光札 4 枚', ids('松に鶴', '桜に幕', '芒に月', '柳に小野道風')),
      yaku('三光', '5 点', '柳以外の光札 3 枚', ids('松に鶴', '桜に幕', '芒に月')),
      yaku('猪鹿蝶', '5 点', '萩の猪・紅葉の鹿・牡丹の蝶', ids('萩に猪', '紅葉に鹿', '牡丹に蝶')),
      yaku('花見で一杯', '5 点', '桜に幕と菊に盃（設定で外せます）', ids('桜に幕', '菊に盃')),
      yaku('月見で一杯', '5 点', '芒に月と菊に盃（設定で外せます）', ids('芒に月', '菊に盃')),
      yaku('赤短', '5 点', '文様のある赤い短冊 3 枚', ids('松に赤短', '梅に赤短', '桜に赤短')),
      yaku('青短', '5 点', '青い短冊 3 枚', ids('牡丹に青短', '菊に青短', '紅葉に青短')),
      yaku('赤短・青短', '10 点', '赤短と青短の 6 枚', []),
      yaku('タネ', '1 点〜', 'タネ札 5 枚で 1 点、1 枚増えるごとに 1 点', []),
      yaku('タン', '1 点〜', '短冊 5 枚で 1 点、1 枚増えるごとに 1 点', []),
      yaku('カス', '1 点〜', 'カス札 10 枚で 1 点、1 枚増えるごとに 1 点（菊に盃もカスに数えられます。設定で外せます）', [])),
    ul(['上がったときの点が 7 点以上なら倍（設定で外せます）', 'こいこいした相手から上がると倍（設定で外せます）'])),
  sec('札の一覧', h('div', { class: 'deck-list' }, MONTH_NAMES.map((m, i) => h('div', { class: 'month' },
    h('b', {}, m),
    h('div', { class: 'mini' }, CARDS.filter((c) => c.month === i).map((c) => h('figure', {}, h('img', { src: cardUrl(c.id), alt: c.name }), h('figcaption', {}, `${c.name}（${KIND_NAMES[c.kind]}）`)))))))),
  sec('演出について',
    ul([
      '応援ゲージ：良い札を取ったり役に近づいたりすると、応援が集まって空間の光が増えます。得点には関係しない演出です',
      '最後の月は「最終決戦」。空間の色が変わります',
      '札の絵柄・演出はこのゲームのために作った独自のものです',
    ])),
));
