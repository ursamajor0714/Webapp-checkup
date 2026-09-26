// QA 대상 설정
const path = require('path');
module.exports = {
  name: '순수 JS 정적 페이지',
  root: path.resolve(process.env.HOME, 'Developer/universeproject'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:8080',
  serverDirs: [],                    // 서버 소스 폴더
  serverExt: [],
  clientDirs: ['.'],                    // 화면 소스 폴더
  clientExt: ['.js', '.html'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
