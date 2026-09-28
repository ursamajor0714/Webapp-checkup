<?php
$conn = mysqli_connect('localhost', 'app', '', 'app');
// 심은 버그: 요청 값을 SQL 에 그대로, 그대로 화면에
$r = mysqli_query($conn, "SELECT * FROM posts WHERE id = $_GET[id]");
echo $_GET['msg'];
?><html><body>홈</body></html>
