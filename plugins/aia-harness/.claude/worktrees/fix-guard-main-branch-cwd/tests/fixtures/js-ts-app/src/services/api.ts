export async function fetchData(url: string): Promise<string> {
  const res = await fetch(url);
  return res.text();
}
