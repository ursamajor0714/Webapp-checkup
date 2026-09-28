<?php
namespace App\Controllers\Admin;
class Dashboard extends \App\Controllers\BaseController {
    public function show($id) { return view('admin'); }
}
