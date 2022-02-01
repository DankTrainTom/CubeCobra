const mtgdraftbots = import('mtgdraftbots');

let calculateBotPick = async () => null;

const setupDraftbots = async () => {
  const resolved = await mtgdraftbots;
  await resolved.initializeDraftbots();
  calculateBotPick = resolved.calculateBotPick;
};

module.exports = {
  setupDraftbots,
  calculateBotPick: (...params) => calculateBotPick(...params),
};
