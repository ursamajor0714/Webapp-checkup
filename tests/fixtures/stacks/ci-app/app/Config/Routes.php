<?php
// QA 시험용 CodeIgniter 4 앱 — 경로 읽기·가드 판단·위험 코드를 시험한다
$routes->get('/', 'Home::index');
$routes->post('auth/register', 'Auth::register');
$routes->get('links', '\App\Controllers\Links::index');
$routes->get('links/(:num)', 'Links::show/$1');
$routes->group('admin', ['namespace' => 'App\Controllers\Admin'], static function ($routes) {
    $routes->get('login', 'Auth::loginForm');
    $routes->get('users/(:num)', 'Dashboard::show/$1', ['filter' => 'adminAuth']);
});
$routes->get('search', 'Links::search');
