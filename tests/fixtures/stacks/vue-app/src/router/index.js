import { createRouter, createWebHistory } from 'vue-router';
export default createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: () => import('../views/Home.vue') },
  { path: '/about', component: () => import('../views/About.vue') },
  { path: '/users/:id', component: () => import('../views/User.vue') },
] });
