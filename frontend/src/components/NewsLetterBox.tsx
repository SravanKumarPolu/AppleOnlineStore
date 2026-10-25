import { motion } from "framer-motion";
import { useState } from "react";

const NewsletterBox = () => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const onSubmitHandler = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!email.trim()) return;

    setSubmitted(true);
    setEmail("");

    setTimeout(() => setSubmitted(false), 5000);
  };

  return (
    <motion.div
      className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl px-6 py-8 sm:px-10 text-center"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">
        Subscribe & Get <span className="text-accent">20% Off</span>
      </h2>
      <p className="text-gray-500 text-sm sm:text-base mt-3 mb-6">
        Join our newsletter for exclusive deals, updates, and trends.
      </p>

      <form
        onSubmit={onSubmitHandler}
        className="flex flex-col sm:flex-row items-center gap-3 w-full"
        aria-live="polite"
      >
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          type="email"
          placeholder="Enter your email"
          className="w-full flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-accent focus:outline-none text-gray-800"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button
          type="submit"
          className="bg-black text-white font-medium px-6 py-3 rounded-lg hover:bg-gray-800 transition-all duration-300 w-full sm:w-auto"
        >
          Subscribe
        </button>
      </form>

      {submitted && (
        <motion.p
          className="text-green-600 text-sm mt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          🎉 You're subscribed! Check your inbox.
        </motion.p>
      )}
    </motion.div>
  );
};

export default NewsletterBox;
