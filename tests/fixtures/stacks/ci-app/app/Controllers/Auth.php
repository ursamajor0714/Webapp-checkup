<?php
namespace App\Controllers;
class Auth extends BaseController {
    public function register() {
        $rules = ['password' => 'required|min_length[8]'];
        // 가입 뒤 로그인 화면으로 보낸다 — 가드가 아니다
        return redirect()->to('/auth/login');
    }
}
