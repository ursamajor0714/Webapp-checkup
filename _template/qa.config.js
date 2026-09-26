// QA 대상 설정
const path = require('path');
module.exports = {
  name: '__NAME__',
  root: path.resolve(process.env.HOME, 'Developer/__REPO__'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:3000',
  serverDirs: [],                    // 서버 소스 폴더
  serverExt: ['.js'],
  clientDirs: [],                    // 화면 소스 폴더
  clientExt: ['.js'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
