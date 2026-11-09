/* Match HOME's device-local daytime artwork: 06:00 <= time < 17:00.
   Keep the same refresh events and interval as index.html. */
(function(){
 function apply(){var hour=new Date().getHours();document.body.classList.toggle('yoshi-daytime',hour>=6&&hour<17);}
 apply();setInterval(apply,30000);document.addEventListener('visibilitychange',apply);window.addEventListener('focus',apply);
})();
