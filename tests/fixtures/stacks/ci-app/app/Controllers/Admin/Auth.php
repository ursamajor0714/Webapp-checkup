<?php
namespace App\Controllers\Admin;
class Auth extends \App\Controllers\BaseController {
    public function loginForm() { return view('admin_login'); }
}
