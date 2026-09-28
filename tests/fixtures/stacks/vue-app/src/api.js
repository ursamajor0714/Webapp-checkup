import axios from 'axios';
export const list = () => axios.get('/api/items');
export const login = body => fetch('/api/login', { method: 'POST', body: JSON.stringify(body) });
