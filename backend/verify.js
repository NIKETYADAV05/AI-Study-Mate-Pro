const http = require("http");

const text = `Enterprise Java (Java EE / Jakarta EE)

Java EE (Java Platform, Enterprise Edition) is a set of specifications that extend Java SE for large-scale, multi-tier enterprise applications. It was originally called J2EE and later renamed to Java EE. Oracle donated it to the Eclipse Foundation, where it was renamed Jakarta EE. This marked a definitive break from the javax.* namespace to jakarta.* starting in Jakarta EE 9.

- EJB (Enterprise JavaBeans): A server-side component model for scalable transactional business logic.
- JPA (Java Persistence API): The standard ORM specification. Hibernate is the most popular JPA provider.
- JDBC (Java Database Connectivity): Low-level Java API for direct SQL database access.
- JAAS (Java Authentication and Authorization Service): Provides authentication and access control.
- JMS (Java Message Service): Enables asynchronous messaging via queues and topics.
- JTA (Java Transaction API): Manages distributed transactions across multiple resources.
- AOP (Aspect-Oriented Programming): Separates cross-cutting concerns like logging from business logic.

Contexts and Dependency Injection (CDI) is the standard DI framework. Spring Framework and MicroProfile both target microservices. Oracle renamed the javax.* packages to jakarta.* in Jakarta EE 9. Jakarta EE 9 also standardised the new namespace.`;

const body = JSON.stringify({ text, subject: "Java", length: "medium" });

http.request(
  { hostname:"127.0.0.1", port:8000, path:"/api/summarize/", method:"POST",
    headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)} },
  (res) => {
    let raw = ""; res.on("data", c => raw += c);
    res.on("end", () => {
      const d = JSON.parse(raw);
      process.stdout.write("HTTP " + res.statusCode + "\n");
      process.stdout.write("\n=== summary_sentences (" + d.summary_sentences.length + ") ===\n");
      d.summary_sentences.forEach((s,i) => process.stdout.write(" ["+i+"] "+s+"\n"));

      const danglers = d.summary_sentences.filter(s => /^(This|These|Those)\b/i.test(s));
      process.stdout.write("\nCHECK dangling-pronoun: " + danglers.length + " (want 0)\n");
      danglers.forEach(s => process.stdout.write("  BAD: "+s+"\n"));

      const j9 = d.summary_sentences.filter(s =>
        /jakarta.*9|javax.*jakarta|standardised.*namespace/i.test(s));
      process.stdout.write("CHECK jakarta-EE-9 dupes: " + j9.length + " (want <=1)\n");
      j9.forEach(s => process.stdout.write("  >> "+s+"\n"));

      const frags = d.summary_sentences.filter(s =>
        /^(Low-level|The standard ORM|Provides|Manages|Enables|Separates)\b/.test(s));
      process.stdout.write("CHECK fragments: " + frags.length + " (want 0)\n");
      frags.forEach(s => process.stdout.write("  BAD: "+s+"\n"));

      process.stdout.write("\n=== important_terms (" + d.important_terms.length + ") ===\n");
      process.stdout.write("isArray: " + Array.isArray(d.important_terms) + "\n");
      d.important_terms.forEach((t,i) => process.stdout.write(" ["+i+"]=" + JSON.stringify(t)));
      process.stdout.write("\n");

      const chips = Array.isArray(d.important_terms)
        ? d.important_terms : String(d.important_terms).split(/[\s,]+/).filter(Boolean);
      process.stdout.write("Chips rendered separately: " + chips.every(c=>typeof c==="string"&&c.length>0) + "  count: " + chips.length + "\n");

      const allPassed = danglers.length===0 && j9.length<=1 && frags.length===0;
      process.stdout.write("\n" + (allPassed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED") + "\n");
    });
  }
).on("error", e => process.stderr.write("ERROR: "+e.message+"\n")).end(body);
