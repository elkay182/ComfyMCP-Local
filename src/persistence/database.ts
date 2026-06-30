export type DatabaseHandle = {
  path: string;
};

export function openDatabase(path: string): DatabaseHandle {
  return { path };
}
