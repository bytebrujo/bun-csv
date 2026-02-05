import { clientOnly } from "@solidjs/start";
import Hero from "../components/Hero";
import BenchmarkChart from "../components/BenchmarkChart";
import Features from "../components/Features";
import Footer from "../components/Footer";

const CodeExample = clientOnly(() => import("../components/CodeExample"));

export default function Home() {
  return (
    <>
      <Hero />
      <BenchmarkChart />
      <Features />
      <CodeExample />
      <Footer />
    </>
  );
}
