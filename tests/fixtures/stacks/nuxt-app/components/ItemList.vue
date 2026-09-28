<script setup>
const { data } = await useFetch('/api/items');
const add = () => $fetch('/api/items', { method: 'POST', body: { title: 'x' } });
</script>
<template><ul><li v-for="i in data">{{ i.title }}</li></ul></template>
