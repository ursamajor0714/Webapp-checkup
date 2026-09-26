// 스택 목록 — 감지 순서가 중요하다 (Next.js 는 React 이기도 하고, Django 는 템플릿 화면도 가진다)
const clients = require('./clients');
const STACKS = {
  nextjs: require('./nextjs'),
  django: require('./django'),
  spring: require('./spring'),
  fastapi: require('./fastapi'),
  express: require('./express'),
  expo: clients.expo,
  react: clients.react,
  static: clients.static,
  templates: clients.templates,
};
const ORDER = ['nextjs', 'django', 'spring', 'fastapi', 'express', 'expo', 'react', 'static'];
module.exports = { STACKS, ORDER };
