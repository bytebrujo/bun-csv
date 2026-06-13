import "./BenchmarkChart.css";

export default function BenchmarkChart() {
  return (
    <section class="benchmark" id="benchmark">
      <div class="container">
        <h2>Performance Comparison</h2>
        <p class="benchmark-subtitle">
          End-to-end benchmark including file reads on Apple Silicon. Clean generated CSV data. Higher is better.
        </p>

        <div class="benchmark-table">
          <table>
            <thead>
              <tr>
                <th>Library</th>
                <th>1K rows</th>
                <th>10K rows</th>
                <th>100K rows</th>
              </tr>
            </thead>
            <tbody>
              <tr class="highlight">
                <td>TurboCSV Fast Mode</td>
                <td>116.5 MB/s</td>
                <td>177.4 MB/s</td>
                <td>172.4 MB/s</td>
              </tr>
              <tr>
                <td>PapaParse</td>
                <td>65.8 MB/s</td>
                <td>98.7 MB/s</td>
                <td>111.5 MB/s</td>
              </tr>
              <tr>
                <td>TurboCSV Native</td>
                <td>42.5 MB/s</td>
                <td>53.0 MB/s</td>
                <td>57.6 MB/s</td>
              </tr>
              <tr>
                <td>csv-parse</td>
                <td>25.1 MB/s</td>
                <td>35.1 MB/s</td>
                <td>33.3 MB/s</td>
              </tr>
              <tr>
                <td>fast-csv</td>
                <td>22.7 MB/s</td>
                <td>33.5 MB/s</td>
                <td>32.6 MB/s</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="benchmark-note">
          Fast Mode is optimized for simple CSV without quoted delimiters or multi-line fields. Run it yourself:
          {" "}<code>bun run benchmark:compare</code>
        </p>
      </div>
    </section>
  );
}
