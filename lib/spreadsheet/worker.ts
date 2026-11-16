import { readWorkbook } from "./read";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ sheets: await readWorkbook(event.data) });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
