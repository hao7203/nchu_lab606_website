import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
    initializeAppCheck,
    ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app-check.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDSsNfKu-G2GJkIzd4_zM0wm49UgJ7_xm0",
    authDomain: "nchu606lab.firebaseapp.com",
    projectId: "nchu606lab",
    storageBucket: "nchu606lab.firebasestorage.app",
    messagingSenderId: "174937158180",
    appId: "1:174937158180:web:90ac6670124fe33f191eb1",
    measurementId: "G-70S0W54JLL"
};

export const app = initializeApp(firebaseConfig);

export const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(
        "6LdHPWEtAAAAAP-zDjVaD7etRrDAaujyQSIOhCBt"
    ),
    isTokenAutoRefreshEnabled: true
});

export const db = getFirestore(app);
export const auth = getAuth(app);
