// QA 대상 설정
const path = require('path');
module.exports = {
  name: 'Expo(React Native) + Express',
  root: path.resolve(process.env.HOME, 'Developer/healthcheck-app'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:3000',
  serverDirs: ['healthcheck-app-backend'],                    // 서버 소스 폴더
  serverExt: ['.js'],
  clientDirs: ['healthcheck-app-frontend/app', 'healthcheck-app-frontend/components'],                    // 화면 소스 폴더
  clientExt: ['.ts', '.tsx'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
