// 심은 버그: 없는 값을 화면에 그대로 찍는다 (undefined·NaN), 없는 DOM id 를 찾는다, 비밀 키가 박혀 있다
const API_SECRET_KEY = 'sk_live_9f8e7d6c5b4a3f2e1d0c9b8a';
const order = { price: 1000 };
document.getElementById('total').textContent = '합계: ' + order.count + '개 · ' + (order.price * order.count) + '원';
function calc() { document.getElementById('result-box').textContent = 'ok'; }
