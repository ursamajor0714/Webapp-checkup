// QA 대상 설정
const path = require('path');
module.exports = {
  name: 'React + Spring Boot',
  root: path.resolve(process.env.HOME, 'Developer/Team_Namoo'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:8080',
  serverDirs: ['Team_Namoo_server/src/main/java'],                    // 서버 소스 폴더
  serverExt: ['.java'],
  clientDirs: ['Team_Namoo_Front/src'],                    // 화면 소스 폴더
  clientExt: ['.js', '.jsx'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
