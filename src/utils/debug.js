// Exporter une fonction qui vérifie DEBUG à chaque appel
export const debug = (...args) => {
  if (process.env.DEBUG) {
    console.log(...args);
  }
};
