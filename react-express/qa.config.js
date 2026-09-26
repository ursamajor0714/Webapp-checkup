// QA 대상 설정
const path = require('path');
module.exports = {
  name: 'React + Express',
  root: path.resolve(process.env.HOME, 'Developer/Team-Lambda'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:3000',
  serverDirs: ['backend'],                    // 서버 소스 폴더
  serverExt: ['.js'],
  clientDirs: ['frontend/src'],                    // 화면 소스 폴더
  clientExt: ['.js', '.jsx'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
