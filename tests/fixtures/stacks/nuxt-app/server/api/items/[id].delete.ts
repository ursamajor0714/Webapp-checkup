export default defineEventHandler(event => ({ ok: getRouterParam(event, 'id') }));
