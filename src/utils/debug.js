// Exporter une fonction qui vérifie DEBUG à chaque appel
export const debug = (...args) => {
  if (process.env.DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}]`, ...args);
  }
};

// Helper function for timestamped error logging
export const errorWithTimestamp = (...args) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}]`, ...args);
};
