<?php
require_once 'func.php';
// 이미 로그인했으면 넘긴다 — 가드가 아니다
if (isAdminLoggedIn()) { header('Location: index.php'); exit; }
?><html><body><form method="post"><input name="pw"></form></body></html>
