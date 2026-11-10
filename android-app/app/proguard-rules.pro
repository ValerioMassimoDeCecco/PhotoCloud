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

