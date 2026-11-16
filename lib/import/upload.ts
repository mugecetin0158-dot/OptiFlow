const csvUploadMessages = [
  "Unsupported file type. Upload .csv files only.",
  "The file is empty. Choose a file containing data.",
] as const;

export function localizeCSVUploadMessage(
  message: string,
  translate: (value: string) => string,
) {
  const key = csvUploadMessages.find(
    (candidate) =>
      message === candidate || message.endsWith(`: ${candidate}`),
  );
  if (!key) return translate(message);
  return message.slice(0, -key.length) + translate(key);
}

export function validateCSVUploadFiles(files: { name: string; size: number }[]) {
  for (const file of files) {
    if (!/\.csv$/i.test(file.name))
      throw Error(`${file.name}: Unsupported file type. Upload .csv files only.`);
    if (!file.size)
      throw Error(`${file.name}: The file is empty. Choose a file containing data.`);
  }
}
