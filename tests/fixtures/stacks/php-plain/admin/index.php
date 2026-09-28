<?php
require_once 'func.php';
if (!isAdminLoggedIn()) { header('Location: login.php'); exit; }
?><html><body>관리자</body></html>
