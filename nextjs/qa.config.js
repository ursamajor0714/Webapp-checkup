// QA 대상 설정
const path = require('path');
module.exports = {
  name: 'Next.js (App Router)',
  root: path.resolve(process.env.HOME, 'Developer/pyroguard2d'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:3000',
  serverDirs: ['app/api'],                    // 서버 소스 폴더
  serverExt: ['.ts'],
  clientDirs: ['app', 'components'],                    // 화면 소스 폴더
  clientExt: ['.ts', '.tsx'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
