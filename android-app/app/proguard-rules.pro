# PhotoCloud Release ProGuard Rules
-keep class com.valerio.photocloud.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn okhttp3.**
-dontwarn okio.**

# MediaPipe Tasks Vision & TensorFlow Lite JNI rules
-keep class com.google.mediapipe.** { *; }
-keep interface com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *

# BouncyCastle bcprov-jdk18on (Argon2id KDF - Argon2BytesGenerator)
-keep class org.bouncycastle.crypto.generators.Argon2BytesGenerator { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters { *; }
-keep class org.bouncycastle.crypto.params.Argon2Parameters$Builder { *; }
-keep class org.bouncycastle.crypto.digests.Blake2bDigest { *; }
-dontwarn org.bouncycastle.jce.provider.**
-dontwarn org.bouncycastle.jcajce.**
-dontwarn javax.naming.**
