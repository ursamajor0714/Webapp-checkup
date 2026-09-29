// 스택 목록 — 감지 순서가 중요하다 (Next·Nuxt 는 React·Vue 이기도 하고, Django 는 템플릿 화면도 가진다, Nest 는 Express 위에 돈다)
const clients = require('./clients');
const php = require('./php');
const STACKS = {
  nextjs: require('./nextjs'),
  nuxt: require('./nuxt'),
  django: require('./django'),
  spring: require('./spring'),
  fastapi: require('./fastapi'),
  nestjs: require('./nestjs'),
  koa: require('./koa'),
  express: require('./express'),
  expo: clients.expo,
  vue: clients.vue,
  react: clients.react,
  swift: require('./swift'),
  codeigniter: php.codeigniter,
  php: php.php,
  static: clients.static,
  templates: clients.templates,
};
const ORDER = ['nextjs', 'nuxt', 'django', 'spring', 'fastapi', 'nestjs', 'koa', 'express', 'expo', 'vue', 'react', 'swift', 'codeigniter', 'php', 'static'];
module.exports = { STACKS, ORDER };
