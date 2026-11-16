// Caixa fictícia para experimentar sem credenciais (demo: true).
const now = Date.now();
const h = (n) => new Date(now - n * 3600_000).toISOString();
const D = (n) => h(n * 24);
const me = { monco: { name: 'David', address: 'david@monco.io' }, bitnik: { name: 'David', address: 'david@bitnik.games' } };
const P = {
  rita: { name: 'Rita Sousa', address: 'rita.sousa@agrupamento-exemplo.pt' },
  tom: { name: 'Tom Becker', address: 'tom@boardgame-blog.example' },
  ana: { name: 'Ana Lopes', address: 'ana@tabletop-mag.example' },
  joana: { name: 'Joana M.', address: 'joana.m@mail.example' },
  fest: { name: 'Festival Jogos', address: 'org@festival-jogos.example' },
  host: { name: 'Hosting Co', address: 'billing@hosting.example' },
  carla: { name: 'Carla Pinto', address: 'carla.pinto@escola-exemplo.pt' },
};

// [account, folder, uid, id, inReplyTo, from, to, date, seen, subject, text]
const raw = [
  // Rita — trocas anteriores em outubro + pedido novo
  ['monco', 'INBOX', 90, 'r1', null, P.rita, me.monco, D(34), true, 'Oficinas de robótica no 2.º período', 'Olá David,\n\nO agrupamento está a planear atividades de robótica para o 2.º período. Faz sessões com micro:bit?\n\nRita'],
  ['monco', 'Sent', 801, 'r2', 'r1', me.monco, P.rita, D(33), true, 'Re: Oficinas de robótica no 2.º período', 'Olá Rita,\n\nNeste momento estou focado em modelação 3D (3D Monco) e apps com IA para professores. Se fizer sentido, posso propor uma oficina de 3D.\n\nDavid'],
  ['monco', 'INBOX', 101, 'r3', null, P.rita, me.monco, h(2), false, 'Oficina de modelação 3D — disponibilidade em janeiro?', 'Olá David,\n\nRetomando a nossa conversa de outubro: gostávamos de levar a oficina de modelação 3D com o 3D Monco a duas turmas do 7.º ano em janeiro. Teria disponibilidade às quartas de manhã? Precisamos também de saber o valor por sessão e se os alunos precisam de conta.\n\nObrigada,\nRita Sousa\nCoordenadora TIC'],
  // Tom — pitch enviado e resposta
  ['bitnik', 'Sent', 901, 't1', null, me.bitnik, P.tom, D(6), true, 'Bulbous — a small-box game for review', 'Hi Tom,\n\nI run bitnikgames, a tiny Portuguese publisher. Bulbous is a 20-minute card game for 2-5 players. Would you be interested in a review copy?\n\nDavid'],
  ['bitnik', 'INBOX', 201, 't2', 't1', P.tom, me.bitnik, h(5), false, 'Re: Bulbous — a small-box game for review', 'Hi David,\n\nThanks for the pitch. Bulbous sounds like a good fit for our "small box" series. Could you send a print-and-play file or a physical copy? Our next review slot is in late January. Also, is there a press kit with images?\n\nCheers,\nTom'],
  // Ana — pitch sem resposta
  ['bitnik', 'Sent', 902, 'a1', null, me.bitnik, P.ana, D(6), true, 'Bulbous — a small-box game for review', 'Hi Ana,\n\nI run bitnikgames, a tiny Portuguese publisher. Bulbous is a 20-minute card game for 2-5 players. Would you be interested in a review copy?\n\nDavid'],
  // Carla — conversa em curso (3 mensagens)
  ['monco', 'INBOX', 95, 'c1', null, P.carla, me.monco, D(9), true, 'Pixel3D — orçamento para o agrupamento', 'Bom dia,\n\nPodia enviar um orçamento para 4 sessões de Pixel3D com professores (formação de curta duração)?\n\nCarla Pinto'],
  ['monco', 'Sent', 805, 'c2', 'c1', me.monco, P.carla, D(8), true, 'Re: Pixel3D — orçamento para o agrupamento', 'Bom dia Carla,\n\nSegue proposta: 4 sessões de 2h, 90 € por sessão, com materiais incluídos. Posso faturar como ato isolado.\n\nDavid'],
  ['monco', 'INBOX', 103, 'c3', 'c2', P.carla, me.monco, h(30), false, 'Re: Pixel3D — orçamento para o agrupamento', 'Obrigada David. A direção aprovou. Podemos começar a 13 de janeiro? Precisamos do NIF e de uma declaração de não dívida para o processo.\n\nCarla'],
  // Outros
  ['monco', 'INBOX', 102, 'f1', null, P.host, me.monco, h(20), true, 'Fatura #2026-114', 'A sua fatura mensal está disponível. Valor: 6,00 €. Débito automático a 20/11.'],
  ['bitnik', 'INBOX', 202, 'j1', null, P.joana, me.bitnik, h(26), true, 'Pergunta sobre o Print & Play', 'Boa tarde! Comprei o print & play do Bulbous mas o PDF das cartas sai cortado na margem quando imprimo em A4. Há alguma versão com margens maiores? Obrigada.'],
  ['bitnik', 'INBOX', 203, 'e1', null, P.fest, me.bitnik, h(50), true, 'Convite: mesa de editoras independentes — Leiria', 'Caro editor,\n\nEstamos a organizar uma mesa de editoras independentes portuguesas em março. Interessa-lhe participar com uma demonstração? Inscrições até 15 de dezembro.\n\nCumprimentos,\nA organização'],
];

const msgs = raw.map(([account, folder, uid, id, irt, from, to, date, seen, subject, text]) => ({
  account, folder, uid, messageId: `<${id}@demo>`, inReplyTo: irt ? `<${irt}@demo>` : null,
  references: irt ? [`<${irt}@demo>`] : [], from: [from], to: [to], date, seen, subject, text,
}));

export const demoAccounts = [
  { id: 'monco', label: 'monco.io', address: 'david@monco.io', color: '#2f6f4f' },
  { id: 'bitnik', label: 'bitnik.games', address: 'david@bitnik.games', color: '#c2571a' },
];

export function demoList(accId, { folder = 'INBOX', query = '' } = {}) {
  const q = query.toLowerCase();
  return msgs
    .filter((m) => m.account === accId && m.folder === folder)
    .filter((m) => !q || JSON.stringify(m).toLowerCase().includes(q))
    .map(({ text, references, ...m }) => ({ ...m, snippet: text.replace(/\s+/g, ' ').slice(0, 160), preview: text.slice(0, 1500) }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
export function demoGet(accId, uid, folder = 'INBOX') {
  const m = msgs.find((x) => x.account === accId && x.uid === Number(uid) && x.folder === folder);
  if (!m) throw new Error('Mensagem não encontrada');
  return { cc: [], replyTo: [], html: '', attachments: [], ...m };
}
export function demoSeen(accId, uid, on) {
  const m = msgs.find((x) => x.account === accId && x.uid === Number(uid) && x.folder === 'INBOX');
  if (m) m.seen = on;
}
