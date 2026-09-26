// QA 대상 설정
const path = require('path');
module.exports = {
  name: 'Django (템플릿)',
  root: path.resolve(process.env.HOME, 'Developer/django-community-crud'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:8000',
  serverDirs: ['myapp', 'config'],                    // 서버 소스 폴더
  serverExt: ['.py'],
  clientDirs: ['myapp/templates', 'templates'],                    // 화면 소스 폴더
  clientExt: ['.html'],
  ignore: ['node_modules', '.git', 'reports', 'dist', 'build'],
};
