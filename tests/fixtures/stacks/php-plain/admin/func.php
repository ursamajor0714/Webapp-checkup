<?php
function isAdminLoggedIn() { return isset($_SESSION['admin_id']); }
