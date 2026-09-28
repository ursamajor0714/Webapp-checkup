export default defineEventHandler(async event => {
  const { title, price } = await readBody(event);
  return { id: 2, title, price };
});
