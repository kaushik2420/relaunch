"use client";
import { useEffect } from "react";
import Script from "next/script";
import posthog from "posthog-js";

declare global {
  interface Window {
    Razorpay?: new (opts: object) => { open: () => void };
  }
}

export function CheckoutLauncher({
  subscriptionId,
  razorpayKeyId,
  userEmail,
  userName,
  userPhone,
}: {
  subscriptionId: string;
  razorpayKeyId: string;
  userEmail: string;
  userName: string;
  userPhone: string;
}) {
  useEffect(() => {
    const launch = () => {
      if (!window.Razorpay) return;
      const rzp = new window.Razorpay({
        key: razorpayKeyId,
        subscription_id: subscriptionId,
        name: "Relaunch",
        description: "Monthly subscription",
        prefill: { email: userEmail, name: userName, contact: userPhone },
        theme: { color: "#2C5239" },
      });
      rzp.open();
    };
    // Script loads asynchronously; retry until ready
    const id = setInterval(() => {
      if (window.Razorpay) {
        clearInterval(id);
        launch();
      }
    }, 200);
    return () => clearInterval(id);
  }, [subscriptionId, razorpayKeyId, userEmail, userName, userPhone]);

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />
      <button
        className="btn-primary mt-6"
        onClick={() => {
          if (window.Razorpay) {
            posthog.capture("checkout_opened", {
              subscription_id: subscriptionId,
            });
            const rzp = new window.Razorpay({
              key: razorpayKeyId,
              subscription_id: subscriptionId,
              name: "Relaunch",
              prefill: { email: userEmail, name: userName, contact: userPhone },
              theme: { color: "#2C5239" },
            });
            rzp.open();
          }
        }}
      >
        Open checkout
      </button>
    </>
  );
}
