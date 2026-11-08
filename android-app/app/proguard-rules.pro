# PhotoCloud Release ProGuard Rules
-keep class com.valerio.photocloud.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn okhttp3.**
-dontwarn okio.**
