<?php
namespace App\Controllers;
class Links extends BaseController {
    public function index() {
        if (! session()->get('user_id')) {
            return redirect()->to('/auth/login');
        }
        return view('links');
    }
    public function show($id) { return view('links'); }
    public function search() {
        $db = \Config\Database::connect();
        // 심은 버그: 요청 값을 SQL 에 그대로
        return $this->response->setJSON($db->query("SELECT * FROM links WHERE title LIKE '%" . $this->request->getGet('q') . "%'")->getResult());
    }
}
